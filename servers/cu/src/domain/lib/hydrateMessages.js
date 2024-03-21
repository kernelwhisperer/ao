import { compose as composeStreams, Transform } from 'node:stream'

import { of } from 'hyper-async'
import { mergeRight } from 'ramda'
import { z } from 'zod'
import WarpArBundles from 'warp-arbundles'

import { loadTransactionDataSchema, loadTransactionMetaSchema } from '../dal.js'
import { messageSchema, streamSchema } from '../model.js'
import { findRawTag } from '../utils.js'

const { createData } = WarpArBundles

/**
 * The result that is produced from this step
 * and added to ctx.
 *
 * This is used to parse the output to ensure the correct shape
 * is always added to context
 */
const ctxSchema = z.object({
  messages: streamSchema
}).passthrough()

function loadFromChainWith ({ loadTransactionData, loadTransactionMeta }) {
  loadTransactionData = loadTransactionDataSchema.implement(loadTransactionData)
  loadTransactionMeta = loadTransactionMetaSchema.implement(loadTransactionMeta)

  return async (id, encodeData) => Promise.all([
    loadTransactionData(id)
      .then(res => res.arrayBuffer())
      .then((ab) => Buffer.from(ab)),
    loadTransactionMeta(id)
  ])
  /**
   * Construct the JSON representation of a DataItem using
   * raw transaction data, and metadata about the
   * transactions (in the shape of a GQL Gateway Transaction)
   */
    .then(async ([data, meta]) => ({
      Id: meta.id,
      Signature: meta.signature,
      Owner: meta.owner.address,
      From: meta.owner.address,
      Tags: meta.tags,
      Anchor: meta.anchor,
      /**
       * Encode the array buffer of the raw data as base64, if desired.
       *
       * TODO: should data always be a buffer, or should cu use Content-Type
       * tag to parse data? ie. json, text, etc.
       */
      Data: encodeData ? bytesToBase64(data) : data
    }))
}

/**
 * Converts an arraybuffer into base64, also handling
 * the Unicode Problem: https://developer.mozilla.org/en-US/docs/Glossary/Base64#the_unicode_problem
 */
export function bytesToBase64 (bytes) {
  return Buffer.from(bytes).toString('base64')
}

export function maybeMessageIdWith ({ logger }) {
  /**
   * To calculate the messageId, we set the owner to 0 bytes,
   * and so the owner length will also be 0 bytes.
   *
   * So we pass in these signer parameters when creating the data item
   * so that all of the lengths match up
   */
  const signer = {
    publicKey: Buffer.from(''),
    ownerLength: 0,
    signatureLength: 512,
    signatureType: 1
  }

  /**
   * This function will calculate the deep hash of the information
   * contained in a data item. We use this to detect whether a particular message
   * has already been evaluated, and therefore should be skipped during the current eval
   * (ie. a message was cranked twice)
   */
  async function calcDataItemDeepHash ({ data, tags, target, anchor }) {
    return Promise.resolve()
      .then(() => createData(data, signer, { tags, target, anchor }))
      .then((dataItem) => dataItem.getSignatureData())
      .then(bytesToBase64)
  }

  return async function * maybeMessageId (messages) {
    for await (const cur of messages) {
      /**
       * Not forwarded, so no need to calculate a message id
       */
      if (!cur.message['Forwarded-By']) {
        yield cur
        continue
      }

      try {
        /**
         * TODO: if the message is ill-formatted in anyway, ie. incorrect length anchor
         * or target, it will cause eval to fail entirely.
         *
         * But skipping the message doesn't seem kosher. What should we do?
         */
        cur.deepHash = await calcDataItemDeepHash({
          data: cur.message.Data,
          tags: cur.message.Tags,
          target: cur.message.Target,
          anchor: cur.message.Anchor
        })
        yield cur
      } catch (err) {
        logger(
          'Encountered Error when calculating deep hash of message "%s"',
          cur.message.Id,
          err
        )
        throw err
      }
    }
  }
}

/**
 * @deprecated Load messages will be replaced by Assignments of on-chain messages.
 * Keeping code here, to be deactivated at block AO_LOAD_MAX_BLOCK
 */
export function maybeAoLoadWith ({ loadTransactionData, loadTransactionMeta, AO_LOAD_MAX_BLOCK, logger }) {
  const loadFromChain = loadFromChainWith({ loadTransactionData, loadTransactionMeta })

  return async function * maybeAoLoad (messages) {
    for await (const cur of messages) {
      const tag = findRawTag('Load', cur.message.Tags)
      /**
       * Either a cron message or not an ao-load message, so no work is needed
       */
      if (!tag || cur.message.Cron) { yield cur; continue }

      /**
       * TODO: should this use the actual current block height,
       * or the block height at the time of scheduling (which is what is currently being checked)
       */
      if (cur.block.height >= AO_LOAD_MAX_BLOCK) {
        logger(
          'Load message "%s" scheduled after block %d. Removing message from eval stream and skipping...',
          cur.message.name,
          AO_LOAD_MAX_BLOCK
        )
        continue
      }
      /**
       * set as 'data' on the ao-load message
       */
      cur.message.Data = await loadFromChain(tag.value, true)

      yield cur
    }
  }
}

export function maybeAoAssignmentWith ({ loadTransactionData, loadTransactionMeta }) {
  const loadFromChain = loadFromChainWith({ loadTransactionData, loadTransactionMeta })

  return async function * maybeAoAssignment (messages) {
    for await (const cur of messages) {
      /**
       * Not an Assignment so nothing to do
       */
      if (!cur.isAssignment) { yield cur; continue }

      /**
       * The values are loaded from chain and used to overwrite
       * the specific fields on the message
       *
       * TODO: should Owner be overwritten? If so, what about From?
       * currently, this will overwrite both, set to the owner of the message on-chain
       */
      cur.message = mergeRight(cur.message, await loadFromChain(cur.message.Id))

      yield cur
    }
  }
}

/**
 * @typedef Args
 * @property {string} id - the id of the process
 *
 * @typedef Result
 * @property {Stream} messages - the stream of messages, with calculated messageIds, data loading, and Forwarded-By and
 *
 * @callback LoadSource
 * @param {Args} args
 * @returns {Async<Result & Args>}
 *
 * @param {any} env
 * @returns {LoadSource}
 */
export function hydrateMessagesWith (env) {
  const logger = env.logger.child('hydrateMessages')
  env = { ...env, logger }

  const maybeMessageId = maybeMessageIdWith(env)
  const maybeAoLoad = maybeAoLoadWith(env)
  const maybeAoAssignment = maybeAoAssignmentWith(env)

  return (ctx) => {
    return of(ctx)
      .map(({ messages: $messages }) => {
        /**
         * There is some sort of bug in pipeline which will consistently cause this stream
         * to not end IFF it emits an error.
         *
         * When errors are thrown in other places, pipeline seems to work and close the stream just fine.
         * So not sure what's going on here.
         *
         * This seemed to be the only way to successfully
         * end the stream, thus closing the pipeline, and resolving
         * the promise wrapping the stream (see finished in evaluate.js)
         *
         * See https://github.com/nodejs/node/issues/40279#issuecomment-1061124430
         */
        $messages.on('error', () => $messages.emit('end'))

        return composeStreams(
          $messages,
          Transform.from(maybeMessageId),
          Transform.from(maybeAoLoad),
          Transform.from(maybeAoAssignment),
          // Ensure every message emitted satisfies the schema
          Transform.from(async function * (messages) {
            for await (const cur of messages) yield messageSchema.parse(cur)
          })
        )
      })
      .map(messages => ({ messages }))
      .map(mergeRight(ctx))
      .map(ctxSchema.parse)
  }
}
