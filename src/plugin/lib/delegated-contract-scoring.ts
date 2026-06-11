export interface DelegatedContractScore {
  completeness: number;
  verificationQuality: number;
  contradictionRisk: number;
  confidenceQuality: number;
  relevance: number;
  total: number;
  needsFollowup: boolean;
  recommendSwitchAgent: boolean;
  recommendRetryWithContext: boolean;
}

export function scoreDelegatedContract(text: string): DelegatedContractScore {
  const lower = text.toLowerCase();
  const completeness = ["summary", "files", "verification", "risks"].filter((section) => lower.includes(section)).length / 4;
  const verificationQuality = /pass|0 fail|verified|evidence/i.test(text) ? 1 : /not run|missing verification/i.test(text) ? 0.2 : 0.4;
  const contradictionRisk = /but|however|contradict|not verified/i.test(lower) ? 0.4 : 0.9;
  const confidenceQuality = /confidence|high|medium|low/i.test(lower) ? 0.9 : 0.3;
  const relevance = text.length > 80 ? 0.8 : 0.4;
  const total = Math.round(((completeness * 0.3) + (verificationQuality * 0.25) + (contradictionRisk * 0.15) + (confidenceQuality * 0.15) + (relevance * 0.15)) * 100) / 100;
  return {
    completeness,
    verificationQuality,
    contradictionRisk,
    confidenceQuality,
    relevance,
    total,
    needsFollowup: total < 0.65,
    recommendSwitchAgent: total < 0.4,
    recommendRetryWithContext: total >= 0.4 && total < 0.65,
  };
}
