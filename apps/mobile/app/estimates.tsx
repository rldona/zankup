/**
 * Estimates (OS-519), from You: VDOT, FTP, critical speed, threshold heart rate and race predictions,
 * each from the efforts of the last 90 days and with the activities it comes from. They describe how
 * you are now, so they are not tied to the Stats period.
 */
import { Estimates } from '../src/stats/Sections';
import { Screen } from '../src/ui';

export default function EstimatesScreen() {
  return (
    <Screen header>
      <Estimates />
    </Screen>
  );
}
