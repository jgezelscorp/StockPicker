declare module 'google-trends-api' {
  interface TrendOptions {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
    property?: string;
    resolution?: string;
    granularTimeResolution?: boolean;
  }

  export function interestOverTime(options: TrendOptions): Promise<string>;
  export function interestByRegion(options: TrendOptions): Promise<string>;
  export function relatedQueries(options: TrendOptions): Promise<string>;
  export function relatedTopics(options: TrendOptions): Promise<string>;
  export function dailyTrends(options: { geo: string; trendDate?: Date }): Promise<string>;
  export function realTimeTrends(options: { geo: string; category?: string }): Promise<string>;
}
