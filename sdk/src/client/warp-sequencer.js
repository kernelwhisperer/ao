import { fromPromise, of } from "hyper-async";
import {
  __,
  applySpec,
  assoc,
  compose,
  evolve,
  map,
  path,
  pipe,
  prop,
  reduce,
  transduce,
} from "ramda";
import { z } from "zod";

import { interactionSchema } from "../dal.js";

/**
 * An implementation of the Sequencer client using
 * the Warp Sequencer
 */

/**
 * @typedef Env3
 * @property {fetch} fetch
 * @property {string} SEQUENCER_URL
 *
 * @typedef LoadInteractionsArgs
 * @property {string} id - the contract id
 * @property {string} from - the lower-most block height
 * @property {string} to - the upper-most block height
 *
 * @callback LoadInteractions
 * @param {LoadInteractionsArgs} args
 * @returns {Async<Record<string, any>}
 *
 * @param {Env3} env
 * @returns {LoadInteractions}
 */
export function loadInteractionsWith({ fetch, SEQUENCER_URL }) {
  // TODO: create a dataloader and use that to batch load interactions

  const interactionsPageSchema = z.object({
    paging: z.record(z.any()),
    interactions: z.array(z.object({
      interaction: z.object({
        tags: z.array(z.object({
          name: z.string(),
          value: z.string(),
        })),
        block: z.object({
          id: z.string(),
          /**
           * These come back as strings from the sequencer
           * despite the values actually being numbers
           * on the graph
           *
           * So we will coerce them to a number
           */
          height: z.coerce.number(),
          timestamp: z.coerce.number(),
        }),
        sortKey: z.string(),
      }),
    })),
  });

  /**
   * Pad the block height portion of the sortKey to 12 characters
   *
   * This should work to increment and properly pad any sort key:
   * - 000001257294,1694181441598,fb1ebd7d621d1398acc03e108b7a593c6960c6e522772c974cd21c2ba7ac11d5 (full Sequencer sort key)
   * - 000001257294,fb1ebd7d621d1398acc03e108b7a593c6960c6e522772c974cd21c2ba7ac11d5 (Smartweave protocol sort key)
   * - 1257294,1694181441598,fb1ebd7d621d1398acc03e108b7a593c6960c6e522772c974cd21c2ba7ac11d5 (missing padding)
   * - 1257294 (just block height)
   *
   * @param {string} sortKey - the sortKey to be padded. If the sortKey is of sufficient length, then no padding
   * is added.
   */
  const padBlockHeight = (sortKey) => {
    if (!sortKey) return sortKey;
    const [height, ...rest] = String(sortKey).split(",");
    return [height.padStart(12, "0"), ...rest].join(",");
  };

  const mapBounds = evolve({
    from: padBlockHeight,
    to: pipe(
      /**
       * Potentially increment the block height by 1, so
       * the sequencer will include any interactions in that block
       */
      (sortKey) => {
        if (!sortKey) return sortKey;
        const parts = String(sortKey).split(",");
        /**
         * Full sort key, so no need to increment
         */
        if (parts.length > 1) return parts.join(",");

        /**
         * only the block height is being used as the sort key
         */
        const [height] = parts;
        if (!height) return height;
        const num = parseInt(height);
        return String(num + 1);
      },
      /**
       * Still ensure the proper padding is added
       */
      padBlockHeight,
    ),
  });

  /**
   * See https://academy.warp.cc/docs/gateway/http/get/interactions
   */
  return (ctx) =>
    of({ id: ctx.id, from: ctx.from, to: ctx.to })
      .map(mapBounds)
      .chain(fromPromise(({ id, from, to }) =>
        /**
         * A couple quirks to highlight here:
         *
         * - The sequencer returns interactions sorted by block height, DESCENDING order
         *   so in order to fold interactions, chronologically, we need to reverse the order of interactions
         *   prior to returning (see unshift instead of push in trasducer below)
         *
         * - The block height included in both to and from need to be left padded with 0's to reach 12 characters (See https://academy.warp.cc/docs/sdk/advanced/bundled-interaction#how-it-works)
         *   (see padBlockHeight above or impl)
         *
         * - 'from' is inclusive
         *
         * - 'to' is non-inclusive IF only the block height is used at the sort key, so if we want to include interactions in the block at 'to', then we need to increment the block height by 1
         *    (see mapBounds above where we increment to block height by one)
         */
        fetch(
          // TODO: need to be able to load multiple pages until all interactions are fetched
          `${SEQUENCER_URL}/gateway/v2/interactions-sort-key?contractId=${id}&from=${from}&to=${to}`,
        )
          .then((res) => res.json())
          .then(interactionsPageSchema.parse)
          .then(prop("interactions"))
          .then((interactions) =>
            transduce(
              // { interaction: { tags: [ { name, value }] } }
              compose(
                // [ { name, value } ]
                map(path(["interaction"])),
                map(applySpec({
                  sortKey: prop("sortKey"),
                  action: pipe(
                    path(["tags"]),
                    // { first: tag, second: tag }
                    reduce((a, t) => assoc(t.name, t.value, a), {}),
                    // "{\"function\": \"balance\"}"
                    prop("Input"),
                    // { function: "balance" }
                    (input) => JSON.parse(input),
                  ),
                })),
              ),
              (acc, input) => {
                acc.unshift(input);
                return acc;
              },
              [],
              interactions,
            )
          )
          .then(z.array(interactionSchema).parse)
      )).toPromise();
}

/**
 * @typedef Env3
 * @property {fetch} fetch
 * @property {string} SEQUENCER_URL
 *
 * @typedef LoadInteractionsArgs
 * @property {string} id - the contract id
 * @property {string} from - the lower-most block height
 * @property {string} to - the upper-most block height
 *
 * @callback LoadInteractions
 * @param {LoadInteractionsArgs} args
 * @returns {Async<Record<string, any>}
 *
 * @param {Env3} env
 * @returns {LoadInteractions}
 */
export function writeInteractionWith({ fetch, SEQUENCER_URL }) {
  return async (transaction) => {
    // verify input
    // construct request to sequencer ie. url, body, headers
    // make call
    // return shape that we care about
  };
}