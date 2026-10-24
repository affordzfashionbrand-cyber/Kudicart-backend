export type KycStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type WorkPreference = 'FULL_TIME' | 'PART_TIME';
export type VehicleType = 'Bike' | 'Electric Scooter' | 'Scooter' | 'Cycle';
export type DocumentType = 'aadhaar' | 'pan' | 'drivingLicence' | 'vehicleRc' | 'selfie';
export type DocumentSide = 'front' | 'back';

export interface DocumentFileRecord {
  uri: string;
  name: string;
  size: string;
  type: string;
  uploadedAt: string;
}

export interface DocumentSidePair {
  front: DocumentFileRecord | null;
  back: DocumentFileRecord | null;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rejectionReason?: string;
}

export interface DriverKycDocuments {
  aadhaar: DocumentSidePair;
  pan: DocumentSidePair;
  drivingLicence: DocumentSidePair;
  vehicleRc: DocumentSidePair;
  selfie: DocumentFileRecord | null;
}

export interface VehicleRecord {
  registrationNumber: string;
  vehicleType: string;
  make: string;
  model: string;
  rcStatus: 'Verified' | 'Under review' | 'Needs attention';
  rcNumber?: string;
}

export interface DriverEntity {
  id: string;
  userId: string;
  fullName: string;
  name: string;
  role: string;
  status: string;
  phone: string;
  email: string;
  tier: string;
  avatarInitial: string;
  photo?: string;
  aadhaarNumber: string;
  panNumber: string;
  dob: string;
  licenseNumber: string;
  workPreference: WorkPreference;
  rating: number;
  completedDeliveries: number;
  isOnline: boolean;
  kycStatus: KycStatus;
  rejectionReason?: string;
  vehicle: VehicleRecord;
  documents: DriverKycDocuments;
  currentLocation: {
    latitude: number;
    longitude: number;
    heading: number;
    updatedAt: string;
  };
}

export type SlotStatus = 'AVAILABLE' | 'BOOKED' | 'FULL' | 'LOCKED';

export interface SlotEntity {
  id: string;
  dateKey: string;
  timeRange: string;
  demand: 'High demand' | 'Normal demand';
  bonusText?: string;
  capacity: number;
  bookedRiderIds: string[];
}

export interface FullTimeShiftEntity {
  id: string;
  day: string;
  dateStr: string;
  timeRange: string;
  duration: string;
  hub: string;
  hubAddress: string;
  status: 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'DAY_OFF';
  statusLabel: string;
  breakTime?: string;
  attendance?: string;
  isToday?: boolean;
}

export interface SurgeIncentiveEntity {
  id: string;
  type: 'SURGE' | 'RAIN_SURGE';
  headline: string;
  amountText: string;
  bonusAmount: number;
  supportingText: string;
  timeRemaining: string;
  zone: string;
  condition: string;
  isActive: boolean;
}

export interface DriverNotificationEntity {
  id: string;
  driverId: string;
  category: 'ORDER' | 'SURGE' | 'SHIFT' | 'PAYOUT' | 'SYSTEM';
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  amount?: string;
  actionRoute?: string;
  actionLabel?: string;
  createdAt: string;
}

export type TryAndBuyStage =
  | 'HANDOVER_PENDING'
  | 'TRIAL_IN_PROGRESS'
  | 'SELECTION_CONFIRMED'
  | 'RETURN_COLLECTION'
  | 'PAYMENT_PENDING'
  | 'RETURNING_TO_STORE'
  | 'STORE_RECONCILIATION'
  | 'WAITING_STORE_CONFIRMATION';
