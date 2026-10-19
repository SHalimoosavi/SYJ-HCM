-- Offer references are tenant-scoped business identifiers. The historical
-- schema incorrectly enforced global uniqueness, while the application
-- generates the next reference per organization.

ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_offer_reference_key;
DROP INDEX IF EXISTS public.offers_reference_idx;
CREATE UNIQUE INDEX IF NOT EXISTS offers_reference_tenant_idx ON public.offers(organization_id, offer_reference);
