import { describe, expect, it } from 'vitest';
import { centeredCrop, clampCrop, cropRect, MAX_ZOOM, zoomAround } from './photoCrop';
import { displayPhotoURL, newProfilePhotoName, profilePhotoPath } from './profilePhoto';

describe('photo crop', () => {
  it('centres a landscape picture on its short side', () => {
    expect(cropRect(400, 200, centeredCrop())).toEqual({ sx: 100, sy: 0, size: 200 });
  });

  it('centres a portrait picture', () => {
    expect(cropRect(300, 600, centeredCrop())).toEqual({ sx: 0, sy: 150, size: 300 });
  });

  it('keeps the picture covering the square', () => {
    // A square at zoom 1 can't move at all
    expect(clampCrop(100, 100, { zoom: 1, x: 0.3, y: -0.2 })).toEqual({ zoom: 1, x: 0, y: 0 });
    // A 2:1 picture can slide half a square either way
    expect(clampCrop(200, 100, { zoom: 1, x: 2, y: 0 }).x).toBeCloseTo(0.5);
    expect(cropRect(200, 100, { zoom: 1, x: 0.5, y: 0 })).toEqual({ sx: 0, sy: 0, size: 100 });
    expect(cropRect(200, 100, { zoom: 1, x: -0.5, y: 0 })).toEqual({ sx: 100, sy: 0, size: 100 });
  });

  it('limits the zoom', () => {
    expect(clampCrop(100, 100, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
    expect(clampCrop(100, 100, { zoom: 99, x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });

  it('zooms around the pinch point', () => {
    // Zooming 2× around the top-left corner of the square shows the picture's top-left quarter
    const crop = zoomAround(100, 100, centeredCrop(), 2, { x: -0.5, y: -0.5 });
    expect(cropRect(100, 100, crop)).toEqual({ sx: 0, sy: 0, size: 50 });
  });
});

describe('profile photo helpers', () => {
  const url = (path: string) =>
    `https://firebasestorage.googleapis.com/v0/b/ofek-beli-ranker.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=abc-123`;

  it('prefers the uploaded photo over the Google one', () => {
    expect(displayPhotoURL({ photoURL: 'g' }, 'c')).toBe('c');
    expect(displayPhotoURL({ photoURL: 'g' }, null)).toBe('g');
    expect(displayPhotoURL({ photoURL: null }, undefined)).toBeNull();
    expect(displayPhotoURL(null, null)).toBeNull();
  });

  it('only deletes files in your own folder', () => {
    expect(profilePhotoPath(url('profilePhotos/alice/a.webp'), 'alice')).toBe('profilePhotos/alice/a.webp');
    expect(profilePhotoPath(url('profilePhotos/bob/a.webp'), 'alice')).toBeNull();
    expect(profilePhotoPath(url('profilePhotos/alice/x/a.webp'), 'alice')).toBeNull();
    expect(profilePhotoPath('https://lh3.googleusercontent.com/a/xyz=s96-c', 'alice')).toBeNull();
    expect(
      profilePhotoPath('http://127.0.0.1:9199/v0/b/b/o/profilePhotos%2Falice%2Fa.jpg?alt=media&token=t', 'alice')
    ).toBe('profilePhotos/alice/a.jpg');
  });

  it('names each upload freshly, matching storage.rules', () => {
    const a = newProfilePhotoName('image/webp', 1);
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,64}\.webp$/);
    expect(newProfilePhotoName('image/jpeg')).toMatch(/^[A-Za-z0-9_-]{1,64}\.jpg$/);
    expect(newProfilePhotoName('image/webp', 1)).not.toBe(a);
  });
});
