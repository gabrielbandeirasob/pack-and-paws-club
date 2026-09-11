import { plural } from '@/lib/plural';

describe('plural', () => {
  it('usa o singular com 1', () => {
    expect(plural(1, 'driver', 'drivers')).toBe('1 driver');
    expect(plural(1, 'stop', 'stops')).toBe('1 stop');
  });

  it('usa o plural com 0 e com mais de 1', () => {
    expect(plural(0, 'driver', 'drivers')).toBe('0 drivers');
    expect(plural(2, 'driver', 'drivers')).toBe('2 drivers');
  });
});