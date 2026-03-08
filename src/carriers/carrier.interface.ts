import { RateQuote } from "./dtos/rate-quote.dto";
import { RateRequest } from "./dtos/rate-request.dto";

export interface CarrierAdapter {
     getRates(request: RateRequest): Promise<RateQuote[]>
}