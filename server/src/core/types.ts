export interface AllegroParameter {
  id: string;
  name?: string;
  values?: string[] | null;
  valuesLabels?: string[] | null;
  valuesIds?: string[] | null;
  unit?: string | null;
  rangeValue?: { from?: string; to?: string };
}

export interface AllegroProduct {
  id?: string;
  name?: string;
  category?: { id: string };
  parameters?: AllegroParameter[];
  images?: string[] | { url: string }[];
}

export interface AllegroProductSetItem {
  product: AllegroProduct;
  quantity?: { value: number };
  responsiblePerson?: ResponsiblePersonRef | null;
  responsibleProducer?: ResponsibleProducerRef | null;
  safetyInformation?: SafetyInformationText | null;
  marketedBeforeGPSRObligation?: boolean | null;
}

export interface AllegroOffer {
  id?: string;
  name?: string;
  category?: { id: string };
  productSet?: AllegroProductSetItem[];
  sellingMode?: {
    format?: string;
    price?: { amount: string; currency: string };
    minimalPrice?: { amount: string; currency: string };
  };
  stock?: { available: number; unit?: string };
  delivery?: {
    shippingRates?: { id: string };
    handlingTime?: string;
    [k: string]: unknown;
  };
  payments?: { invoice?: string };
  afterSalesServices?: {
    impliedWarranty?: { id: string } | null;
    returnPolicy?: { id: string } | null;
    warranty?: { id: string } | null;
  };
  description?: unknown;
  images?: { url: string }[] | string[];
  publication?: {
    status?: 'INACTIVE' | 'ACTIVE' | 'ACTIVATING' | 'ENDED';
    startingAt?: string;
    endingAt?: string;
    duration?: string;
    [k: string]: unknown;
  };
  parameters?: AllegroParameter[];
  // permissive — Allegro response has many more fields we just pass through
  [k: string]: unknown;
}

export interface PublicationCommandStatus {
  id: string;
  publication: {
    status: 'NEW' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';
  };
  taskCount?: { total: number; success: number; failed: number };
  errors?: Array<{ message: string; code?: string; [k: string]: unknown }>;
}

export interface ProductSearchHit {
  id: string;
  name: string;
  category?: { id: string };
  parameters?: AllegroParameter[];
  images?: { url: string }[];
}

export interface ProductSearchResponse {
  products: ProductSearchHit[];
  // Allegro returns the next-page cursor under `nextPage.id` for `/sale/products`.
  // (Spec: developer.allegro.pl/documentation/#operation/getSaleProducts)
  nextPage?: { id?: string };
}

export interface CategoryParameter {
  id: string;
  name: string;
  type:
    | 'string'
    | 'integer'
    | 'float'
    | 'dictionary'
    | 'date'
    | 'boolean'
    | string;
  required?: boolean;
  unit?: string;
  restrictions?: Record<string, unknown>;
  dictionary?: Array<{ id?: string; value: string }>;
  options?: Record<string, unknown>;
}

export interface CategoryParametersResponse {
  parameters: CategoryParameter[];
}

export interface GpsrAddress {
  countryCode: string;
  street: string;
  postalCode: string;
  city: string;
}

export interface GpsrContact {
  email?: string;
  phoneNumber?: string;
  formUrl?: string;
}

export interface ResponsiblePerson {
  id: string;
  name: string;
  personalData: {
    name: string;
    address: GpsrAddress;
    contact: GpsrContact;
  };
}

export interface ResponsibleProducer {
  id: string;
  name: string;
  producerData: {
    tradeName: string;
    address: GpsrAddress;
    contact: GpsrContact;
  };
}

/** Reference put on productSet[].responsibleProducer in the offer body. */
export type ResponsibleProducerRef =
  | { type: 'ID'; id: string }
  | { type: 'NAME'; name: string };

/** Reference put on productSet[].responsiblePerson in the offer body. */
export type ResponsiblePersonRef = { id: string } | { name: string };

export interface SafetyInformationText {
  type: 'TEXT';
  description: string;
}

/**
 * Reference to an account-scoped offer dictionary entry — shipping rate,
 * return policy, implied warranty or warranty. Allegro POST accepts id or name.
 */
export interface NamedRef {
  id: string;
  name?: string;
}
