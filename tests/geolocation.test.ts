import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinates } from '../src/lib/geolocation';

function form(lat: string | null, lng: string | null): FormData {
  const data = new FormData();
  if (lat !== null) data.set('lat', lat);
  if (lng !== null) data.set('lng', lng);
  return data;
}

test('valid latitude and longitude are accepted', () => {
  assert.deepEqual(parseCoordinates(form('17.3850', '78.4867')), { latitude: 17.385, longitude: 78.4867 });
});

test('missing coordinates are allowed', () => {
  assert.equal(parseCoordinates(form(null, null)), null);
});

test('partial coordinates are rejected', () => {
  assert.throws(() => parseCoordinates(form('17.3850', null)), /provided together/);
});

test('out-of-range coordinates are rejected', () => {
  assert.throws(() => parseCoordinates(form('91', '78')), /Latitude/);
  assert.throws(() => parseCoordinates(form('17', '181')), /Longitude/);
});

test('non-finite coordinates are rejected', () => {
  assert.throws(() => parseCoordinates(form('NaN', '78')), /valid numbers/);
});
