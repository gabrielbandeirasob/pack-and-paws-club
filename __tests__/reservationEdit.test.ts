import { endDateForService, isValidISODate, reservationUpdatePayload } from '@/features/calendar/reservationsService';

const base = {
  service_type: 'daycare',
  start_date: '2026-09-15',
  end_date: '2026-09-15',
  transport_required: true,
  status: 'confirmed',
  notes: '  ',
};

describe('edição de reserva', () => {
  it('valida datas de verdade (não aceita 31 de fevereiro)', () => {
    expect(isValidISODate('2026-02-28')).toBe(true);
    expect(isValidISODate('2026-02-31')).toBe(false);
    expect(isValidISODate('15/09/2026')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });

  it('monta o payload e limpa notas vazias', () => {
    const payload = reservationUpdatePayload(base);
    expect(payload.notes).toBeNull();
    expect(payload.service_type).toBe('daycare');
    expect(payload.transport_required).toBe(true);
  });

  it('recusa fim antes do início (constraint do banco: end_date >= start_date)', () => {
    expect(() => reservationUpdatePayload({ ...base, service_type: 'boarding', end_date: '2026-09-10' })).toThrow();
  });

  it('aceita hospedagem com período maior', () => {
    const payload = reservationUpdatePayload({ ...base, service_type: 'boarding', end_date: '2026-09-20' });
    expect(payload.end_date).toBe('2026-09-20');
  });

  it('recusa serviço ou status inválido', () => {
    expect(() => reservationUpdatePayload({ ...base, service_type: 'grooming' })).toThrow();
    expect(() => reservationUpdatePayload({ ...base, status: 'pending' })).toThrow();
  });

  it('permite cancelar a reserva (status cancelled) e voltar atrás', () => {
    expect(reservationUpdatePayload({ ...base, status: 'cancelled' }).status).toBe('cancelled');
    expect(reservationUpdatePayload({ ...base, status: 'confirmed' }).status).toBe('confirmed');
  });

  it('daycare é um dia só: o fim acompanha o início', () => {
    expect(endDateForService('daycare', '2026-09-15', '2026-09-20')).toBe('2026-09-15');
    expect(endDateForService('boarding', '2026-09-15', '2026-09-20')).toBe('2026-09-20');
    expect(endDateForService('boarding', '2026-09-15', '2026-09-10')).toBe('2026-09-15');
  });
});
