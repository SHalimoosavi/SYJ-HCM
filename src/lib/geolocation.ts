export type Coordinates = {
  latitude: number;
  longitude: number;
};

export function parseCoordinates(formData: FormData): Coordinates | null {
  const latValue = String(formData.get('lat') ?? '').trim();
  const lngValue = String(formData.get('lng') ?? '').trim();

  if (!latValue && !lngValue) return null;
  if (!latValue || !lngValue) {
    throw new Error('Latitude and longitude must be provided together.');
  }

  const latitude = Number(latValue);
  const longitude = Number(lngValue);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Latitude and longitude must be valid numbers.');
  }
  if (latitude < -90 || latitude > 90) {
    throw new Error('Latitude must be between -90 and 90.');
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error('Longitude must be between -180 and 180.');
  }

  return { latitude, longitude };
}
