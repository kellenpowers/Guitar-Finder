interface DealBadgeProps {
  score: number | null;
}

export default function DealBadge({ score }: DealBadgeProps) {
  if (score === null || score === undefined) {
    return <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-500">No price data</span>;
  }

  let color = "bg-gray-100 text-gray-600";
  if (score >= 50) color = "bg-green-100 text-green-800";
  else if (score >= 30) color = "bg-yellow-100 text-yellow-800";
  else if (score >= 10) color = "bg-orange-100 text-orange-800";
  else color = "bg-red-100 text-red-700";

  return (
    <span className={`px-2 py-0.5 text-xs font-semibold rounded ${color}`}>
      {score}% below market
    </span>
  );
}
