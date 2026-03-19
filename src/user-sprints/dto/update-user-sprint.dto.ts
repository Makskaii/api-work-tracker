import { PartialType } from '@nestjs/mapped-types';
import { CreateUserSprintDto } from './create-user-sprint.dto';

export class UpdateUserSprintDto extends PartialType(CreateUserSprintDto) {}
