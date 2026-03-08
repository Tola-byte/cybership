import { Module } from "@nestjs/common";
import { CarriersModule } from "../carriers/carrier.module";
import { RatingService } from "./rating.service";

@Module({
  imports: [CarriersModule],
  providers: [RatingService],
  exports: [RatingService],
})
export class RatingModule {}
