import { rowToStop, type DriverStopRow } from '@/features/driver/rows';

const fullRow: DriverStopRow = {
  id: 'stop-1',
  sequence: 1,
  status: 'pending',
  window_end: '08:15:00',
  exact_time: null,
  dog: {
    id: 'dog-1',
    name: 'Marcejamba',
    behavior_notes: 'Foge com barulho de caminhão',
    medical_notes: 'Alergia a frango',
    photo_url: 'https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/dog-photos/org-1/dog-1/marcejamba.jpg',
    client: {
      name: 'Raphael Stefan',
      address_line_1: 'Pier 39',
      city: 'San Francisco',
      latitude: 37.8087,
      longitude: -122.4098,
      client_instructions: { pickup_access_instructions: 'Gate code 4321' },
    },
  },
};

describe('rowToStop', () => {
  it('maps a complete row (dog, client, windows and location)', () => {
    const stop = rowToStop(fullRow);

    expect(stop.clientName).toBe('Raphael Stefan');
    expect(stop.dogName).toBe('Marcejamba');
    expect(stop.address).toBe('Pier 39');
    expect(stop.city).toBe('San Francisco');
    // Notas de seguranca do cao: o motorista PRECISA ver (antes nao chegavam na tela).
    expect(stop.behaviorNotes).toBe('Foge com barulho de caminhão');
    expect(stop.medicalNotes).toBe('Alergia a frango');
    expect(stop.dogPhotoUrl).toContain('/dog-photos/org-1/dog-1/marcejamba.jpg');
    expect(stop.instructions).toBe('Gate code 4321');
    expect(stop.latitude).toBe(37.8087);
    expect(stop.windowEnd).toBe('08:15'); // seconds trimmed for display
    expect(stop.exactTime).toBeNull();
  });

  it('does not crash when RLS hides the dog embed (the bug from migration 013)', () => {
    const stop = rowToStop({ ...fullRow, dog: null });

    expect(stop.dogName).toBe('Dog');
    expect(stop.clientName).toBe('Client');
    expect(stop.address).toBeNull();
    expect(stop.latitude).toBeNull();
    expect(stop.instructions).toBeNull();
    // sem o embed do cao (RLS) nao ha foto — a tela nao pode quebrar por isso
    expect(stop.dogPhotoUrl).toBeNull();
  });

  it('does not crash when the client embed is hidden', () => {
    const stop = rowToStop({ ...fullRow, dog: { ...fullRow.dog!, client: null } });

    expect(stop.dogName).toBe('Marcejamba');
    expect(stop.clientName).toBe('Client');
    expect(stop.instructions).toBeNull();
  });

  it('falls back to placeholder names for blank values', () => {
    const stop = rowToStop({
      ...fullRow,
      dog: { id: 'dog-1', name: '   ', behavior_notes: null, medical_notes: null, client: { name: '', address_line_1: null, city: null, latitude: null, longitude: null, client_instructions: null } },
    });

    expect(stop.dogName).toBe('Dog');
    expect(stop.clientName).toBe('Client');
  });
});
