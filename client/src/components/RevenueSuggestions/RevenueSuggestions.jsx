import { Lightbulb } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import AIInsights from '../common/AIInsights';

// Revenue Growth Suggestions is now entirely AI-driven. The old
// deterministic page hardcoded 8 strategies; they've been removed in favour
// of Gemini 2.5 Flash with Google Search grounding, which reads the live
// Tally summary (top dealers, category mix, DSO, aging) and returns
// concrete revenue plays that cite current market context.
export default function RevenueSuggestions() {
  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Lightbulb}
        title="Revenue Growth Suggestions"
        subtitle="AI-generated growth strategies for your real dealer book, grounded with live web search."
      />
      <AIInsights
        task="revenue-suggestions"
        title="Strategies from AI"
        subtitle="4–6 distinct plays per refresh — rupee uplift estimates and the exact dealers to target."
      />
    </div>
  );
}
