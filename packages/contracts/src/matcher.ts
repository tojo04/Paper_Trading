import { z } from 'zod';

const maxInt64 = 9_223_372_036_854_775_807n;
const minInt64 = -9_223_372_036_854_775_808n;

export const int64StringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/)
  .refine((value) => {
    const parsed = BigInt(value);
    return parsed >= minInt64 && parsed <= maxInt64;
  }, 'Value must fit a signed 64-bit integer');

export const nonNegativeInt64StringSchema = int64StringSchema.refine(
  (value) => BigInt(value) >= 0n,
  'Value must not be negative',
);

export const positiveInt64StringSchema = int64StringSchema.refine(
  (value) => BigInt(value) > 0n,
  'Value must be positive',
);

export const matcherCommandTypeSchema = z.enum([
  'ADD_ORDER',
  'CANCEL_ORDER',
  'RESET',
  'REPLAY_ORDER',
  'SNAPSHOT_BOOK',
  'PING',
]);

const commandBase = {
  protocolVersion: z.literal(1),
  commandId: z.uuid(),
};

const orderFields = {
  orderId: z.uuid(),
  participantId: z.string().min(1),
  instrumentKey: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: positiveInt64StringSchema,
};

const limitOrderPayloadSchema = z
  .object({
    ...orderFields,
    orderType: z.literal('LIMIT'),
    limitPricePaise: positiveInt64StringSchema,
  })
  .strict();

const marketOrderPayloadSchema = z
  .object({
    ...orderFields,
    orderType: z.literal('MARKET'),
  })
  .strict();

export const matcherCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...commandBase,
      type: z.literal('ADD_ORDER'),
      payload: z.discriminatedUnion('orderType', [
        limitOrderPayloadSchema,
        marketOrderPayloadSchema,
      ]),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('CANCEL_ORDER'),
      payload: z.object({ orderId: z.uuid() }).strict(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('RESET'),
      payload: z.object({ sequenceFloor: nonNegativeInt64StringSchema.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('REPLAY_ORDER'),
      payload: limitOrderPayloadSchema.extend({
        remainingQuantity: positiveInt64StringSchema,
        engineSequence: positiveInt64StringSchema,
      }),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('SNAPSHOT_BOOK'),
      payload: z.object({ instrumentKey: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal('PING'),
      payload: z.object({}).strict(),
    })
    .strict(),
]);

const orderStatusSchema = z.enum(['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED']);

const matcherOrderStateSchema = z
  .object({
    orderId: z.string().min(1),
    status: orderStatusSchema,
    filledQuantity: nonNegativeInt64StringSchema,
    remainingQuantity: nonNegativeInt64StringSchema,
    engineSequence: positiveInt64StringSchema,
  })
  .strict();

const matcherFillSchema = z
  .object({
    tradeId: z.string().min(1),
    instrumentKey: z.string().min(1),
    makerOrderId: z.string().min(1),
    takerOrderId: z.string().min(1),
    buyOrderId: z.string().min(1),
    sellOrderId: z.string().min(1),
    quantity: positiveInt64StringSchema,
    pricePaise: positiveInt64StringSchema,
    engineSequence: positiveInt64StringSchema,
  })
  .strict();

const snapshotOrderSchema = z
  .object({
    orderId: z.string().min(1),
    participantId: z.string().min(1),
    remainingQuantity: positiveInt64StringSchema,
    engineSequence: positiveInt64StringSchema,
  })
  .strict();

const priceLevelSchema = z
  .object({
    pricePaise: positiveInt64StringSchema,
    totalQuantity: positiveInt64StringSchema,
    orders: z.array(snapshotOrderSchema),
  })
  .strict();

const bookSnapshotSchema = z
  .object({
    instrumentKey: z.string().min(1),
    bids: z.array(priceLevelSchema),
    asks: z.array(priceLevelSchema),
    bookSequence: nonNegativeInt64StringSchema,
  })
  .strict();

const acceptedBase = {
  protocolVersion: z.literal(1),
  commandId: z.uuid(),
  accepted: z.literal(true),
};

const orderMutationResultSchema = z
  .object({
    bookSequence: nonNegativeInt64StringSchema,
    order: matcherOrderStateSchema,
    fills: z.array(matcherFillSchema).optional(),
    restingOrderUpdates: z.array(matcherOrderStateSchema).optional(),
  })
  .strict();

const rejectedResponseSchema = z
  .object({
    protocolVersion: z.literal(1),
    commandId: z.uuid(),
    type: matcherCommandTypeSchema,
    accepted: z.literal(false),
    rejection: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const matcherResponseSchema = z.union([
  rejectedResponseSchema,
  z
    .object({
      ...acceptedBase,
      type: z.literal('PING'),
      result: z.object({ ready: z.literal(true) }).strict(),
    })
    .strict(),
  z
    .object({
      ...acceptedBase,
      type: z.literal('RESET'),
      result: z.object({ bookSequence: nonNegativeInt64StringSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...acceptedBase,
      type: z.literal('ADD_ORDER'),
      result: orderMutationResultSchema.extend({
        fills: z.array(matcherFillSchema),
        restingOrderUpdates: z.array(matcherOrderStateSchema),
      }),
    })
    .strict(),
  z
    .object({
      ...acceptedBase,
      type: z.literal('CANCEL_ORDER'),
      result: orderMutationResultSchema,
    })
    .strict(),
  z
    .object({
      ...acceptedBase,
      type: z.literal('REPLAY_ORDER'),
      result: orderMutationResultSchema,
    })
    .strict(),
  z
    .object({
      ...acceptedBase,
      type: z.literal('SNAPSHOT_BOOK'),
      result: z
        .object({
          bookSequence: nonNegativeInt64StringSchema,
          snapshot: bookSnapshotSchema,
        })
        .strict(),
    })
    .strict(),
]);

export type MatcherCommand = z.infer<typeof matcherCommandSchema>;
export type MatcherCommandType = z.infer<typeof matcherCommandTypeSchema>;
export type MatcherResponse = z.infer<typeof matcherResponseSchema>;

