import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './services/encryption.service';
import { FieldMaskInterceptor } from './interceptors/field-mask.interceptor';

@Global()
@Module({
  providers: [EncryptionService, FieldMaskInterceptor],
  exports: [EncryptionService, FieldMaskInterceptor],
})
export class CommonModule {}