import { Type } from 'class-transformer'
import { IsDefined, IsIn, IsObject, ValidateIf, ValidateNested } from 'class-validator'
import { UpdateSupportHoursPackageDto } from './update-support-hours-package.dto'

export class PreviewSupportHoursPackageDto {
  @IsIn(['update', 'delete'])
  operation!: 'update' | 'delete'

  @ValidateIf((value: PreviewSupportHoursPackageDto) => value.operation === 'update' || value.changes !== undefined)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateSupportHoursPackageDto)
  changes?: UpdateSupportHoursPackageDto
}
