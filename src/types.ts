export type AwardCabinAvailability = {
  first: number;
  business: number;
  premium: number;
  economy: number;
};

export type FlightOption = {
  direct: boolean;
  marketingAirline: string;
  flightNumbers: string[];
  origin: string;
  destination: string;
  stopCity?: string;
  departureUtc: string;
  arrivalUtc: string;
  durationMinutes: number;
  availability: AwardCabinAvailability;
};

export type SearchResult = {
  date: string; // YYYYMMDD
  from: string; // IATA
  to: string; // IATA
  flights: FlightOption[];
  error?: string;
};

export type WatchItem = {
  id: number;
  from: string;
  to: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  numAdults: number;
  numChildren: number;
  email: string;
  nonstopOnly: number; // 0/1
  minCabin?: "Y" | "W" | "C" | "F"; // notify if at least this cabin available
  createdAt: string;
};