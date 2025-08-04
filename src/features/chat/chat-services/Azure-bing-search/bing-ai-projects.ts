import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

export interface BingAIProjectsSearchResultData {
  answer: string;
  citations: Array<{
    title: string;
    url: string;
    snippet?: string;
    domain?: string;
  }>;
  searchQuery?: string;
  searchResults?: Array<{
    title: string;
    url: string;
    snippet: string;
    domain: string;
  }>;
}

export class BingAIProjectsSearchResult {
  private projectClient: AIProjectClient;
  private agentId: string;
  private projectUrl: string;

  constructor() {
    this.agentId = process.env.AZURE_BING_ASSISTANT_ID || 'asst_107F9Ke8WrwKmcWbi134S57w';
    this.projectUrl = process.env.AZURE_BING_PROJECT_URL || 'https://bing-new-fujibo-resource.services.ai.azure.com/api/projects/bing_new_fujibo';
    
    console.log('\n=== BING AI PROJECTS DEBUG START ===');
    console.log(`Agent ID: ${this.agentId}`);
    console.log(`Project URL: ${this.projectUrl}`);
    console.log('=== END BING AI PROJECTS DEBUG ===\n');
    
    if (!this.projectUrl) {
      console.error('AZURE_BING_PROJECT_URL is not set. Please check your .env.local file.');
    }
    
    if (!this.agentId) {
      console.error('AZURE_BING_ASSISTANT_ID is not set. Please check your .env.local file.');
    }

    this.projectClient = new AIProjectClient(
      this.projectUrl,
      new DefaultAzureCredential()
    );
  }

  async SearchWeb(searchText: string): Promise<BingAIProjectsSearchResultData> {
    console.log(`Search Text: ${searchText}`);
    console.log('Starting AI Projects Agent conversation...');

    try {
      // Get the agent
      console.log('Getting agent...');
      const agent = await this.projectClient.agents.getAgent(this.agentId);
      console.log(`Retrieved agent: ${agent.name}`);

      // Create a thread
      console.log('Creating thread...');
      const thread = await this.projectClient.agents.threads.create();
      console.log(`Created thread, ID: ${thread.id}`);

      // Create a message
      console.log('Creating message...');
      const message = await this.projectClient.agents.messages.create(thread.id, "user", searchText);
      console.log(`Created message, ID: ${message.id}`);

      // Create run
      console.log('Creating run...');
      let run = await this.projectClient.agents.runs.create(thread.id, agent.id);
      console.log(`Created run, ID: ${run.id}, Status: ${run.status}`);

      // Poll until the run reaches a terminal status
      console.log('Polling run status...');
      let attempts = 0;
      const maxAttempts = 60; // 60秒間待機

      while ((run.status === "queued" || run.status === "in_progress") && attempts < maxAttempts) {
        // Wait for a second
        await new Promise((resolve) => setTimeout(resolve, 1000));
        run = await this.projectClient.agents.runs.get(thread.id, run.id);
        console.log(`Run status: ${run.status} (attempt ${attempts + 1}/${maxAttempts})`);
        attempts++;
      }

      if (run.status === "failed") {
        console.error(`Run failed: `, run.lastError);
        throw new Error(`Agent run failed: ${run.lastError?.message || 'Unknown error'}`);
      }

      if (run.status !== "completed") {
        throw new Error(`Run did not complete. Final status: ${run.status}`);
      }

      console.log(`Run completed with status: ${run.status}`);

      // Retrieve messages
      console.log('Retrieving messages...');
      const messages = await this.projectClient.agents.messages.list(thread.id, { order: "asc" });

      // Find the assistant's response
      let assistantResponse = '';
      for await (const m of messages) {
        if (m.role === "assistant") {
          const content = m.content.find((c) => c.type === "text" && "text" in c);
          if (content) {
            assistantResponse = content.text.value;
            break;
          }
        }
      }

      if (!assistantResponse) {
        throw new Error('No assistant response found');
      }

      console.log(`Assistant response: ${assistantResponse.substring(0, 100)}...`);

      // Extract citations and search results from the assistant's response
      const citations: Array<{title: string; url: string; snippet?: string; domain?: string}> = [];
      const searchResults: Array<{title: string; url: string; snippet: string; domain: string}> = [];

      // Try to extract structured information from the response
      // Look for patterns like [title](url) or similar markdown links
      const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let markdownMatch;
      while ((markdownMatch = markdownLinkRegex.exec(assistantResponse)) !== null) {
        const title = markdownMatch[1];
        const url = markdownMatch[2];
        
        if (url.startsWith('http')) {
          const domain = this.extractDomain(url);
          const existingCitation = citations.find(c => c.url === url);
          if (!existingCitation) {
            citations.push({
              title: title || domain || 'Webページ',
              url: url,
              snippet: '',
              domain: domain
            });
          }
        }
      }

      // Also extract plain URLs that might not be in markdown format
      const urlRegex = /https?:\/\/[^\s\)]+/g;
      let urlMatch;
      while ((urlMatch = urlRegex.exec(assistantResponse)) !== null) {
        const url = urlMatch[0];
        const domain = this.extractDomain(url);
        
        // Skip if already found in markdown links
        const existingCitation = citations.find(c => c.url === url);
        if (!existingCitation) {
          citations.push({
            title: domain || 'Webページ',
            url: url,
            snippet: '',
            domain: domain
          });
        }
      }

      // Try to extract search results from the response
      // Look for patterns that indicate search results
      const searchResultPatterns = [
        /検索結果[：:]\s*(.*?)(?=\n|$)/g,
        /見つかった情報[：:]\s*(.*?)(?=\n|$)/g,
        /参考情報[：:]\s*(.*?)(?=\n|$)/g
      ];

      for (const pattern of searchResultPatterns) {
        let match;
        while ((match = pattern.exec(assistantResponse)) !== null) {
          const resultText = match[1];
          // Extract URLs from the result text
          const resultUrlRegex = /https?:\/\/[^\s\)]+/g;
          let resultUrlMatch;
          while ((resultUrlMatch = resultUrlRegex.exec(resultText)) !== null) {
            const url = resultUrlMatch[0];
            const domain = this.extractDomain(url);
            
            // Check if this URL is not already in searchResults
            const existingResult = searchResults.find(r => r.url === url);
            if (!existingResult) {
              searchResults.push({
                title: domain || 'Webページ',
                url: url,
                snippet: resultText.substring(0, 200) + (resultText.length > 200 ? '...' : ''),
                domain: domain
              });
            }
          }
        }
      }

      // If no structured search results found, use citations as search results
      if (searchResults.length === 0 && citations.length > 0) {
        searchResults.push(...citations.map(citation => ({
          title: citation.title,
          url: citation.url,
          snippet: citation.snippet || '',
          domain: citation.domain || ''
        })));
      }

      return {
        answer: assistantResponse,
        citations: citations,
        searchQuery: searchText,
        searchResults: searchResults
      };

    } catch (error) {
      console.error('\n=== BING AI PROJECTS ERROR ===');
      console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      if (error instanceof Error && error.cause) {
        console.error('Error cause:', error.cause);
      }
      
      console.error('=== END BING AI PROJECTS ERROR ===\n');
      throw error;
    }
  }

  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (e) {
      return '';
    }
  }
} 