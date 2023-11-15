import { z } from 'zod'

import { evaluationSchema, processSchema, rawBlockSchema, rawTagSchema, streamSchema } from './model.js'

// Gateway

export const loadTransactionMetaSchema = z.function()
  .args(z.string())
  .returns(z.promise(
    z.object({
      owner: z.object({
        address: z.string()
      }),
      tags: z.array(rawTagSchema)
    }).passthrough()
  ))

export const loadTransactionDataSchema = z.function()
  .args(z.string())
  .returns(z.promise(z.any()))

export const loadBlocksMetaSchema = z.function()
  .args(z.object({ min: z.number(), max: z.number() }))
  .returns(z.promise(
    z.array(
      rawBlockSchema.passthrough()
    )
  ))

// DB

export const findProcessSchema = z.function()
  .args(z.object({ processId: z.string() }))
  .returns(z.promise(processSchema))

export const saveProcessSchema = z.function()
  .args(processSchema)
  .returns(z.promise(z.any()))

export const findLatestEvaluationSchema = z.function()
  .args(z.object({ processId: z.string(), to: z.string().optional() }))
  .returns(z.promise(evaluationSchema))

export const saveEvaluationSchema = z.function()
  .args(evaluationSchema.extend({ deepHash: z.string().optional() }))
  .returns(z.promise(z.any()))

export const findEvaluationsSchema = z.function()
  .args(z.object({
    processId: z.string(),
    from: z.string().optional(),
    to: z.string().optional()
  }))
  .returns(z.promise(z.array(evaluationSchema)))

export const findMessageIdSchema = z.function()
  .args(z.object({
    messageId: z.string().optional()
  }))
  /**
   * Our business logic does use the output of findMessageId,
   * only the presence or absence of the document,
   *
   * So we don't need to enforce a shape to return here,
   * as long as it's a document (an object)
   */
  .returns(z.promise(z.record(z.any())))

// SU

export const loadMessagesSchema = z.function()
  .args(
    z.object({
      processId: z.string(),
      owner: z.string(),
      from: z.string().optional(),
      to: z.string().optional()
    })
  )
  /**
   * Returns a Stream that wraps an AsyncIterable, which is not something that Zod can
   * parse natively, so we make sure the returned value implements a pipe api
   */
  .returns(z.promise(streamSchema))

export const loadProcessSchema = z.function()
  .args(z.string().min(1))
  .returns(z.promise(
    z.object({
      owner: z.string().min(1),
      tags: z.array(rawTagSchema),
      block: rawBlockSchema
    })
  ))

export const loadTimestampSchema = z.function()
  .returns(z.promise(z.object({
    height: z.number(),
    timestamp: z.number()
  })))

export const loadMessageMetaSchema = z.function()
  .args(z.object({ messageTxId: z.string().min(1) }))
  .returns(z.promise(
    z.object({
      processId: z.string().min(1),
      sortKey: z.string().min(1)
    })
  ))
