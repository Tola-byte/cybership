// based on UPS API docs.
export interface UPSAddress {
  AddressLine: string
  City: string
  StateProvinceCode: string
  PostalCode: string
  CountryCode: string
}

export interface UPSShipper {
  ShipperNumber: string   // UPS account numbber
  Address: UPSAddress
}

export interface UPSShipTo {
  Address: UPSAddress
}

export interface UPSShipFrom {
  Address: UPSAddress
}

export interface UPSPackageWeight {
  UnitOfMeasurement: { Code: 'LBS' | 'KGS' }
  Weight: string          
}

export interface UPSPackageDimensions {
  UnitOfMeasurement: { Code: 'IN' | 'CM' }
  Length: string
  Width: string
  Height: string
}

export interface UPSPackage {
  PackagingType: { Code: '02' }  // '02' = customer supplied package
  Dimensions: UPSPackageDimensions
  PackageWeight: UPSPackageWeight
}

export interface UPSShipment {
  Shipper: UPSShipper
  ShipTo: UPSShipTo
  ShipFrom: UPSShipFrom
  Package: UPSPackage
  Service?: { Code: string }    // optional — only for Rate, not Shop
}

export interface UPSRateRequest {
  RateRequest: {
    Request: {
      TransactionReference?: { CustomerContext?: string }
    }
    Shipment: UPSShipment
  }
}



export interface UPSRatedShipment {
  Service: {
    Code: string
    Description: string
  }
  TotalCharges: {
    CurrencyCode: string
    MonetaryValue: string     // UPS returns price as string
  }
  GuaranteedDelivery?: {
    BusinessDaysInTransit?: string
  }
}

export interface UPSRateResponse {
  RateResponse: {
    RatedShipment: UPSRatedShipment | UPSRatedShipment[]  // single or array
  }
}