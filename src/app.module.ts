import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RatingModule } from './rating/rating.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RatingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
