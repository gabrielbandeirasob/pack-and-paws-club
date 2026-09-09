import { render } from '@testing-library/react-native';
import { SectionPlaceholder } from '@/features/common/SectionPlaceholder';

describe('SectionPlaceholder', () => {
  it('renders the requested section title and description', async () => {
    const screen = await render(<SectionPlaceholder title="Calendar" description="Daycare and boarding schedule" />);
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText('Daycare and boarding schedule')).toBeTruthy();
  });
});
