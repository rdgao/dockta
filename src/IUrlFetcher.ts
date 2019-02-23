/**
 * Standard interface that can be used for fetching URLs
 */
export default interface IUrlFetcher {
  /**
   * Fetch a URL
   *
   * @param url URL to fetch
   * @param options Any options
   */
  fetchUrl (url: string, options: any): any
}
