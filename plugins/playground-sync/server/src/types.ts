export interface PlaygroundPrompt {
  id: string;
  prompt: string;
  url: string;
  pathname: string;
  timestamp: number;
}

export interface ServerConfig {
  httpPort: number;
  verbose: boolean;
}
