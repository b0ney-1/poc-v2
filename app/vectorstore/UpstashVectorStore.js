/* eslint-disable @typescript-eslint/no-unused-vars */
import { VectorStore } from "@langchain/core/vectorstores";
import { Document } from "@langchain/core/documents";
import { Index } from "@upstash/vector";
import { maximalMarginalRelevance } from "@langchain/core/utils/math";


export class UpstashVectorStore extends VectorStore {
  _vectorstoreType() {
    return "upstash";
  }

  constructor(embeddings, namespace = null) {
    super(embeddings);

    // Store the namespace if provided
    this.namespace = namespace;

    // Use the correct environment variables
    this.index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN,
    });
    
    console.log('UpstashVectorStore initialized with:');
    console.log('- URL:', process.env.UPSTASH_VECTOR_REST_URL);
    console.log('- Token (first 10 chars):', process.env.UPSTASH_VECTOR_REST_TOKEN?.substring(0, 10) + '...');
    console.log('- Namespace:', this.namespace || 'None (will search across all namespaces)');
  }

  async similaritySearchVectorWithScore(query, k, filter) {
    console.log(`Performing similarity search with ${this.namespace ? 'namespace: ' + this.namespace : 'no specific namespace'}`);
    
    // Get all available namespaces
    let result = [];
    
    if (this.namespace) {
      // If a specific namespace is requested, only search in that namespace
      console.log(`Using namespace: ${this.namespace} for search`);
      const namespaceIndex = this.index.namespace(this.namespace);
      result = await namespaceIndex.query({
        vector: query,
        topK: k,
        includeVectors: false,
        includeMetadata: true,
      });
    } else {
      // If no namespace is specified, search across all namespaces
      console.log('Searching across all namespaces');
      try {
        // Get list of all namespaces
        const namespaces = await this.index.listNamespaces();
        console.log(`Found ${namespaces.length} namespaces:`, namespaces);
        
        // Search in each namespace
        const allResults = [];
        for (const namespace of namespaces) {
          console.log(`Searching in namespace: ${namespace || 'default'}`);
          const namespaceIndex = namespace ? this.index.namespace(namespace) : this.index;
          const namespaceResults = await namespaceIndex.query({
            vector: query,
            topK: k,
            includeVectors: false,
            includeMetadata: true,
          });
          
          // Add namespace information to each result
          namespaceResults.forEach(item => {
            if (item.metadata) {
              item.metadata.source_namespace = namespace || 'default';
            }
            allResults.push(item);
          });
        }
        
        // Sort all results by score and take top k
        allResults.sort((a, b) => b.score - a.score);
        result = allResults.slice(0, k);
        console.log(`Combined results from all namespaces: ${result.length} items`);
      } catch (error) {
        console.error('Error searching across namespaces:', error);
        // Fall back to default namespace if there's an error
        console.log('Falling back to default namespace');
        result = await this.index.query({
          vector: query,
          topK: k,
          includeVectors: false,
          includeMetadata: true,
        });
      }
    }

    const results = [];
    for (let i = 0; i < result.length; i++) {
      results.push([
        new Document({
          pageContent: JSON.stringify(result[i]?.metadata) || "",
        }),
      ]);
    }

    return results;
  }

  async maxMarginalRelevanceSearch(query, options) {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    
    let result = [];
    
    if (this.namespace) {
      // If a specific namespace is requested, only search in that namespace
      console.log(`Using namespace: ${this.namespace} for MMR search`);
      const namespaceIndex = this.index.namespace(this.namespace);
      result = await namespaceIndex.query({
        vector: queryEmbedding,
        topK: options.fetchK ?? 20,
        includeVectors: true,
        includeMetadata: true,
      });
    } else {
      // If no namespace is specified, search across all namespaces
      console.log('Searching across all namespaces for MMR search');
      try {
        // Get list of all namespaces
        const namespaces = await this.index.listNamespaces();
        console.log(`Found ${namespaces.length} namespaces for MMR search:`, namespaces);
        
        // Search in each namespace
        const allResults = [];
        for (const namespace of namespaces) {
          console.log(`MMR searching in namespace: ${namespace || 'default'}`);
          const namespaceIndex = namespace ? this.index.namespace(namespace) : this.index;
          const namespaceResults = await namespaceIndex.query({
            vector: queryEmbedding,
            topK: options.fetchK ?? 20,
            includeVectors: true,
            includeMetadata: true,
          });
          
          // Add namespace information to each result
          namespaceResults.forEach(item => {
            if (item.metadata) {
              item.metadata.source_namespace = namespace || 'default';
            }
            allResults.push(item);
          });
        }
        
        // Sort all results by score and take top fetchK
        allResults.sort((a, b) => b.score - a.score);
        result = allResults.slice(0, options.fetchK ?? 20);
        console.log(`Combined MMR results from all namespaces: ${result.length} items`);
      } catch (error) {
        console.error('Error searching across namespaces for MMR:', error);
        // Fall back to default namespace if there's an error
        console.log('Falling back to default namespace for MMR search');
        result = await this.index.query({
          vector: queryEmbedding,
          topK: options.fetchK ?? 20,
          includeVectors: true,
          includeMetadata: true,
        });
      }
    }
    
    const embeddingList = result.map((r) => r.vector)

    const mmrIndexes = maximalMarginalRelevance(
      queryEmbedding,
      embeddingList,
      options.lambda,
      options.k
    );
    const topMmrMatches = mmrIndexes.map((idx) => result[idx]);

    const results = [];
    for (let i = 0; i < topMmrMatches.length; i++) {
      results.push(
        new Document({
          pageContent: JSON.stringify(topMmrMatches[i]?.metadata) || "",
        }),
      );
    }

    return results;
  }
}