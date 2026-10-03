import { fireEvent, render } from '@testing-library/react-native';
import { DriverRouteView, type DriverStartPoint } from '@/features/driver/DriverRouteView';

const van: DriverStartPoint = {
  kind: 'van', name: 'Route van', address: '10 Main Street · London',
  latitude: 51.5, longitude: -0.1,
};

it('pickup mostra a van com nome/endereço e permite navegar ao início', async () => {
  const onNavigateStart = jest.fn();
  const tela = await render(
    <DriverRouteView stops={[]} onAction={jest.fn()} fase="pickup" start={van} onNavigateStart={onNavigateStart} />,
  );
  expect(tela.getByText('VAN · where the day starts')).toBeTruthy();
  expect(tela.getByText(van.name)).toBeTruthy();
  expect(tela.getByText(van.address!)).toBeTruthy();
  expect(tela.getByLabelText('Navigate to the start')).toBeTruthy();
  await fireEvent.press(tela.getByTestId('navigate-start'));
  expect(onNavigateStart).toHaveBeenCalledTimes(1);
});

it('dropoff mostra o yard e permite navegar mesmo sem endereço textual', async () => {
  const onNavigateStart = jest.fn();
  const tela = await render(
    <DriverRouteView stops={[]} onAction={jest.fn()} fase="dropoff"
      start={{ ...van, kind: 'yard', name: 'Day yard', address: null }} onNavigateStart={onNavigateStart} />,
  );
  expect(tela.getByText('YARD · where the drop-offs start')).toBeTruthy();
  expect(tela.getByText('Day yard')).toBeTruthy();
  expect(tela.queryByText('VAN · where the day starts')).toBeNull();
  await fireEvent.press(tela.getByTestId('navigate-start'));
  expect(onNavigateStart).toHaveBeenCalledTimes(1);
});

it.each([
  ['start ausente', undefined, jest.fn()],
  ['start nulo', null, jest.fn()],
  ['handler ausente', van, undefined],
  ['nome vazio', { ...van, name: '' }, jest.fn()],
  ['nome em branco', { ...van, name: '  ' }, jest.fn()],
] as const)('não mostra cartão de início com %s', async (_, start, onNavigateStart) => {
  const tela = await render(
    <DriverRouteView stops={[]} onAction={jest.fn()} start={start} onNavigateStart={onNavigateStart} />,
  );
  expect(tela.queryByTestId('route-start')).toBeNull();
  expect(tela.queryByTestId('navigate-start')).toBeNull();
});
