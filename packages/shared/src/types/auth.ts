// JWT claims embedded in every access token
export interface JwtClaims {
  sub: string; // user ID (UUID)
  email: string;
}

export interface AuthUser {
  id: string;
  email: string;
}
