import { IsNotEmpty, IsString } from 'class-validator';

export class FirebaseLoginDto {
  @IsNotEmpty({ message: 'Firebase ID Token is required' })
  @IsString()
  idToken: string;
}
