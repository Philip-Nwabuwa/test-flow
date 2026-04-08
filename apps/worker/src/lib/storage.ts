// v1 stub: Storage uploads require service_role key (post-MVP)
export class StorageService {
  async upload(_localPath: string, storagePath: string, _contentType: string): Promise<string> {
    return storagePath;
  }
}
