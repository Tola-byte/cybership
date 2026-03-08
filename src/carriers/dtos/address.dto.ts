// for a shipping rate API for every carrier, we need to have a standard.
// this requires an origin address, destination address, they have same type.

export interface Address {
  street: string
  city: string
  stateCode: string    
  postalCode: string  // made this a string because some postal codes have leading zeros, and we don't want to lose that.
  countryCode: string
}