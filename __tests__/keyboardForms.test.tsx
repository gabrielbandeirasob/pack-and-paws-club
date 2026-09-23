/**
 * Teclado: os formularios precisam estar dentro de um KeyboardAvoidingView, senao no iPhone o
 * teclado tapa os campos de baixo (bug relatado: "quando vou digitar o nome pra adicionar outro
 * cachorro tampa a tela").
 *
 * Trava a REGRESSAO: se alguem tirar o KeyboardAvoidingView, isto falha.
 */
import { render } from '@testing-library/react-native';

// O formulario de cliente agora abre o mapa preferido do gestor (AsyncStorage); no jest o
// modulo nativo nao existe, entao usa o mock oficial da lib.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { EditClientForm, type EditableDog } from '@/features/clients/EditClientForm';
import { EditReservationForm } from '@/features/calendar/EditReservationForm';
import type { EditableClient } from '@/features/clients/clientsService';

const cliente: EditableClient = {
  name: 'Amor',
  phone: '5551234',
  address_line_1: '580 California St',
  address_line_2: '',
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94104',
  notes: '',
  special_scheduling_instructions: '',
  latitude: null,
  longitude: null,
};

const caes: EditableDog[] = [
  { id: 'dog-1', name: 'Filó', breed: 'Poodle', behavior_notes: '', medical_notes: '', photo_url: null },
  { id: 'dog-2', name: 'Melanie', breed: '', behavior_notes: '', medical_notes: '', photo_url: null },
];

describe('teclado nos formularios', () => {
  it('EditClientForm fica dentro de KeyboardAvoidingView e mostra os dois caes', async () => {
    const tela = await render(
      <EditClientForm
        current={cliente}
        dogs={caes}
        instructions={null}
        active
        saving={false}
        error={null}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(tela.getByTestId('teclado-form')).toBeTruthy();
    // os campos do cao (onde o teclado tapava a tela) seguem existindo
    expect(tela.getAllByDisplayValue('Filó').length).toBeGreaterThan(0);
    expect(tela.getAllByDisplayValue('Melanie').length).toBeGreaterThan(0);
  });

  it('EditReservationForm tambem tem KeyboardAvoidingView', async () => {
    const tela = await render(
      <EditReservationForm
        dogLabel="Amor · Filó"
        initial={{
          service_type: 'daycare',
          start_date: '2026-09-12',
          end_date: '2026-09-12',
          transport_required: true,
          status: 'scheduled',
          notes: '',
        }}
        saving={false}
        error={null}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(tela.getByTestId('teclado-form')).toBeTruthy();
  });
});
