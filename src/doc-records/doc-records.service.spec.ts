import { Test, TestingModule } from '@nestjs/testing';
import { DocRecordsService } from './doc-records.service';

describe('DocRecordsService', () => {
  let service: DocRecordsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocRecordsService],
    }).compile();

    service = module.get<DocRecordsService>(DocRecordsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
