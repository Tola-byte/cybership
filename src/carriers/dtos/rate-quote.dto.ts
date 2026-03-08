// this is what we return to the user on successful rate request. all carriers must conform to this standard.

export interface RateQuote {
  carrier: string          
  serviceCode: string      
  serviceName: string      // carriers should have serviceName, and code attached to them
  totalCharge: number      
  currency: string        
  estimatedDays?: number   // optional, carrier might return or not.
}