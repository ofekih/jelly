import { ArrowLeft, ChevronLeft, Share, Share2, type LucideProps } from 'lucide-react';
import { isApplePlatform } from '../lib/pwaService';

// Read once: the platform doesn't change while the app is open.
const APPLE = isApplePlatform();

/** The share icon people know from their own device: Apple's box-and-arrow, elsewhere Android's three dots. */
export function ShareIcon(props: LucideProps) {
  return APPLE ? <Share {...props} /> : <Share2 {...props} />;
}

/** Back: a chevron on Apple devices, an arrow (Android's) elsewhere. */
export function BackIcon(props: LucideProps) {
  return APPLE ? <ChevronLeft {...props} /> : <ArrowLeft {...props} />;
}
