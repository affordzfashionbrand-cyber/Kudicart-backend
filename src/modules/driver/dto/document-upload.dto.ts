import { IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';

export class DocumentUploadDto {
  @IsNotEmpty({ message: 'Document type is required' })
  @IsString()
  @IsIn(['aadhaar', 'pan', 'drivingLicence', 'vehicleRc', 'selfie'], {
    message: 'Invalid document type. Allowed: aadhaar, pan, drivingLicence, vehicleRc, selfie',
  })
  docType: 'aadhaar' | 'pan' | 'drivingLicence' | 'vehicleRc' | 'selfie';

  @IsOptional()
  @IsString()
  @IsIn(['front', 'back'], {
    message: 'Document side must be front or back',
  })
  side?: 'front' | 'back';

  @IsNotEmpty({ message: 'File name is required' })
  @IsString()
  fileName: string;

  @IsNotEmpty({ message: 'File content or URI is required' })
  @IsString()
  fileUri: string;

  @IsOptional()
  @IsString()
  fileSize?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}
