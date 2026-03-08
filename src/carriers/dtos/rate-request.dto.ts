import { Address } from "./address.dto"
import { PackageDimensions } from "./package.dto"

export interface RateRequest {
  origin: Address
  destination: Address
  package: PackageDimensions
  serviceCode?: string  // optional — if omitted return ALL available rates
}