import { z } from 'zod';
import type { BrandEndpoint } from './index';

const id = z.string().min(1).describe('Row id, verbatim from get_studio or list_products');

const PRODUCT_FIELDS = {
  title: z.string().min(1).describe('What the offer is called'),
  description: z.string().describe('What it is, in the brand’s own words'),
  pricing: z.string().describe('Free text as the brand writes it, e.g. "18,50 €" or "Free"'),
  url: z.string().describe('Where the offer lives'),
  kind: z.string().describe('Catalog bucket, e.g. "product", "service", "feature"'),
  featured: z.boolean().describe('Whether the planner may lead with it')
};

const Ok = z.object({ ok: z.literal(true) });

const NOT_FOUND: { error: string; status: number } = { error: 'not_found', status: 404 };
const NO_FIELDS: { error: string; status: number } = { error: 'no_fields', status: 400 };

const CreateProductInputSchema = z
  .object({
    title: PRODUCT_FIELDS.title,
    description: PRODUCT_FIELDS.description.optional(),
    pricing: PRODUCT_FIELDS.pricing.optional(),
    url: PRODUCT_FIELDS.url.optional(),
    kind: PRODUCT_FIELDS.kind.optional(),
    featured: PRODUCT_FIELDS.featured.optional()
  })
  .strict();

const CreateProductResultSchema = z.object({
  ok: z.literal(true),
  product: z.object({
    id: z.string(),
    title: z.string(),
    kind: z.string(),
    pricing: z.string().nullable(),
    featured: z.boolean()
  })
});

export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;
export type CreateProductResult = z.infer<typeof CreateProductResultSchema>;

export const CREATE_PRODUCT = {
  tool: 'create_product',
  title: 'Create product',
  description:
    'Add one offer to the brand catalog. Deterministic: it calls no model and spends no ' +
    'credits. Use it when the catalog does not come from a connected store — sync_products ' +
    'replaces the whole catalog from Shopify or WooCommerce and would erase a hand-made row.',
  method: 'POST',
  pathUnderBrand: '/studio/products',
  input: CreateProductInputSchema,
  output: CreateProductResultSchema,
  failures: [{ error: 'insert_failed', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;

const UpdateProductInputSchema = z
  .object({
    id,
    title: PRODUCT_FIELDS.title.optional(),
    description: PRODUCT_FIELDS.description.optional(),
    pricing: PRODUCT_FIELDS.pricing.optional(),
    url: PRODUCT_FIELDS.url.optional(),
    featured: PRODUCT_FIELDS.featured.optional()
  })
  .strict();

export const UPDATE_PRODUCT = {
  tool: 'update_product',
  title: 'Update product',
  description:
    'Correct one offer in place. Only the fields you send change; every other column keeps the ' +
    'value it had. Calls no model and spends no credits.',
  method: 'PUT',
  pathUnderBrand: '/products/:id',
  resource: 'product',
  input: UpdateProductInputSchema,
  output: Ok,
  failures: [NOT_FOUND, NO_FIELDS, { error: 'update_failed', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;

export const DELETE_PRODUCT = {
  tool: 'delete_product',
  title: 'Delete product',
  description: 'Remove one offer from the brand catalog. It does not come back.',
  method: 'DELETE',
  pathUnderBrand: '/products/:id',
  resource: 'product',
  input: z.object({ id }).strict(),
  output: Ok,
  failures: [NOT_FOUND, { error: 'delete_failed', status: 500 }],
  destructive: true
} satisfies BrandEndpoint;

const UpdatePersonInputSchema = z
  .object({
    id,
    name: z.string().min(1).optional().describe('How the person is called'),
    role: z.string().optional().describe('What they do for the brand'),
    description: z
      .string()
      .optional()
      .describe('Who they are, for the generators that may depict them'),
    attributes: z
      .record(z.string(), z.string())
      .optional()
      .describe('Descriptors of the persona, e.g. { "gender": "female", "ageRange": "30-40" }')
  })
  .strict();

export const UPDATE_PERSON = {
  tool: 'update_person',
  title: 'Update person',
  description:
    'Correct the name, role, description or attributes of a person already in the studio. It ' +
    'cannot attest consent, change a real person into an AI persona, or touch their photos: ' +
    'those stay with the operator. Calls no model and spends no credits.',
  method: 'PUT',
  pathUnderBrand: '/people/:id',
  resource: 'person',
  input: UpdatePersonInputSchema,
  output: Ok,
  failures: [NOT_FOUND, NO_FIELDS, { error: 'update_failed', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;

const UpdateCompetitorInputSchema = z
  .object({
    id,
    name: z.string().min(1).optional().describe('Competitor name'),
    website: z.string().optional().describe('Site; a bare host is read as https'),
    kind: z
      .enum(['direct', 'indirect'])
      .optional()
      .describe('The only two the database accepts'),
    rationale: z.string().optional().describe('Why they belong in the competitive set')
  })
  .strict();

export const UPDATE_COMPETITOR = {
  tool: 'update_competitor',
  title: 'Update competitor',
  description:
    'Correct a competitor already in the studio: a wrong website, a rationale that no longer ' +
    'holds, direct versus indirect. Calls no model and spends no credits.',
  method: 'PUT',
  pathUnderBrand: '/studio/competitors/:id',
  resource: 'competitor',
  input: UpdateCompetitorInputSchema,
  output: Ok,
  failures: [NOT_FOUND, NO_FIELDS, { error: 'update_failed', status: 500 }],
  destructive: false
} satisfies BrandEndpoint;

export const GET_BIO = {
  tool: 'get_bio',
  title: 'Read link in bio',
  description:
    'Read the link in bio stored for the brand and the short link worth putting there — the one ' +
    'with the most clicks in the last seven days.',
  method: 'GET',
  pathUnderBrand: '/bio',
  input: z
    .object({ platform: z.string().optional().describe('Defaults to the first active account') })
    .strict(),
  output: z.object({
    bioUrl: z.string().nullable(),
    suggested: z
      .object({ code: z.string(), url: z.string(), clicks: z.number(), targetUrl: z.string() })
      .nullable()
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SET_BIO = {
  tool: 'set_bio',
  title: 'Set link in bio',
  description:
    'Store the link in bio for the brand. It records the value only: no publishing API exposes a ' +
    'profile bio, so a person still pastes it on the profile by hand. Empty string clears it.',
  method: 'PUT',
  pathUnderBrand: '/bio',
  input: z
    .object({
      bio_url: z.string().describe('http(s) URL, max 500 chars; "" clears the bio'),
      platform: z.string().optional().describe('Defaults to the first active account')
    })
    .strict(),
  output: z.object({ ok: z.literal(true), bioUrl: z.string() }),
  failures: [
    { error: 'bio_url is required', status: 400 },
    { error: 'bio_url is invalid', status: 400 },
    { error: 'bio_url must be an http(s) URL or empty', status: 400 },
    { error: 'No active social account', status: 404 }
  ],
  destructive: false
} satisfies BrandEndpoint;
