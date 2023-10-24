import { identity } from 'ramda'
import pkg from 'warp-arbundles'
import { of, fromPromise, Rejected } from 'hyper-async'

import { createContract, createDataItemSigner } from '@permaweb/ao-sdk'

const { createData, ArweaveSigner } = pkg

function writeMessageWith ({ fetch, SEQUENCER_URL, logger }) {
  return async (data) => {
    return of(Buffer.from(data, 'base64'))
      .map(logger.tap(`Forwarding message to SU ${SEQUENCER_URL}`))
      .chain(fromPromise((body) => {
        fetch(`${SEQUENCER_URL}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            Accept: 'application/json'
          },
          body
        })
      }))
      .bimap(
        logger.tap('Error while communicating with SU:'),
        identity
      )
      .bichain(
        (err) => Rejected(JSON.stringify(err)),
        fromPromise(async (res) => {
          if (!res?.ok) {
            const text = await res.text()
            throw new Error(`${res.status}: ${text}`)
          }
          return res.json()
        })
      )
      .map(logger.tap('Successfully forwarded DataItem to SU'))
      .toPromise()
  }
}

function buildAndSignWith ({ MU_WALLET }) {
  return async ({ processId, data, tags, anchor }) => {
    data = data || Math.random().toString().slice(-4)
    const signer = new ArweaveSigner(MU_WALLET)

    const allTags = [
      ...tags,
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'ao-type', value: 'message' },
      { name: 'SDK', value: 'ao' }
    ]

    const interactionDataItem = createData(data, signer, { target: processId, anchor, tags: allTags })
    await interactionDataItem.sign(signer)
    return {
      id: await interactionDataItem.id,
      data: interactionDataItem.getRaw(),
      processId
    }
  }
}

// TODO: implement find query
function findTxWith ({ SEQUENCER_URL }) {
  return async (txId) => {
    console.log('Searching for tx on sequencer')
    console.log(txId)
    return Promise.reject(new Error('Tx not found on sequencer'))
  }
}

// TODO: inject createContract dep
function writeContractTxWith ({ SEQUENCER_URL, MU_WALLET }) {
  return async ({ initState, src, tags }) => {
    const transformedList = Object.entries(tags).map(([key, value]) => ({
      name: key,
      value
    }))

    const contractId = await createContract({
      srcId: src,
      initialState: initState,
      signer: createDataItemSigner(MU_WALLET),
      transformedList
    })

    return contractId
  }
}

export default {
  writeMessageWith,
  buildAndSignWith,
  findTxWith,
  writeContractTxWith
}