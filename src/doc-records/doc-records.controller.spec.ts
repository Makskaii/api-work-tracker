import { Test, TestingModule } from '@nestjs/testing';
import { DocRecordsController } from './doc-records.controller';
import { DocRecordsService } from './doc-records.service';

describe('DocRecordsController', () => {
  let controller: DocRecordsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocRecordsController],
      providers: [DocRecordsService],
    }).compile();

    controller = module.get<DocRecordsController>(DocRecordsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
