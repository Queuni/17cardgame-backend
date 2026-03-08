export interface RegisterRequestBody {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginRequestBody {
  email: string;
  password: string;
}

export interface UserResponse {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified: boolean;
  createdAt?: string;
  lastSignIn?: string;
}

export interface AuthResponse {
  message: string;
  user?: UserResponse;
  error?: string;
}