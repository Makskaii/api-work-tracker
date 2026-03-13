import { PartialType } from '@nestjs/mapped-types';
import { CreateDocRecordDto } from './create-doc-record.dto';

export class UpdateDocRecordDto extends PartialType(CreateDocRecordDto) {}
