import { Module } from "@nestjs/common";
import { CARRIER_ADAPTERS } from "./carrier.tokens";
import { UpsAuthService } from "./ups/ups-auth.service";
import { UpsRatingAdapter } from "./ups/ups-rating.adapter";

@Module({
  providers: [
    UpsAuthService,
    UpsRatingAdapter,
    {
      provide: CARRIER_ADAPTERS,
      useFactory: (upsRatingAdapter: UpsRatingAdapter): UpsRatingAdapter[] => [
        upsRatingAdapter,
      ],
      inject: [UpsRatingAdapter],
    },
  ],
  exports: [UpsAuthService, UpsRatingAdapter, CARRIER_ADAPTERS],
})
export class CarriersModule {}
