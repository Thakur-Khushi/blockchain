import AnalyticsView from '../../components/AnalyticsView.jsx';
import { PageHeader } from '../../components/common.jsx';

export default function AnalyticsPage() {
  return (
    <div>
      <PageHeader
        title="Wellness analytics"
        description="Trends in your self-rated mood and stress, calculated from your encrypted check-ins. These are descriptive patterns, not a diagnosis."
      />
      <AnalyticsView endpoint="/wellness/analytics" audience="patient" />
    </div>
  );
}
