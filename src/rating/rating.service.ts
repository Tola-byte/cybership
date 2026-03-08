import { Inject, Injectable, Logger } from "@nestjs/common";
import { CarrierAdapter } from "../carriers/carrier.interface";
import { CARRIER_ADAPTERS } from "../carriers/carrier.tokens";
import { RateQuote } from "../carriers/dtos/rate-quote.dto";
import { RateRequest } from "../carriers/dtos/rate-request.dto";

@Injectable()
export class RatingService {
  private readonly logger = new Logger(RatingService.name);

  constructor(
    @Inject(CARRIER_ADAPTERS)
    private readonly adapters: CarrierAdapter[],
  ) {}

  async getRates(request: RateRequest): Promise<RateQuote[]> {
    const settled = await Promise.allSettled(
      this.adapters.map((adapter) => adapter.getRates(request)),
    );

    const quotes: RateQuote[] = [];

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        quotes.push(...result.value);
        return;
      }

      const adapterName = this.getAdapterName(this.adapters[index]);
      this.logger.error(
        `Carrier adapter failed: ${adapterName}`,
        result.reason instanceof Error ? result.reason.stack : String(result.reason),
      );
    });

    return quotes;
  }

  private getAdapterName(adapter: CarrierAdapter | undefined): string {
    if (!adapter) {
      return "UnknownAdapter";
    }
    return adapter.constructor.name ?? "UnknownAdapter";
  }
}
