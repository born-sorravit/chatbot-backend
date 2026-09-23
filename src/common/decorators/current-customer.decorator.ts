import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedCustomer, CustomerRequest } from '../types';

/** Injects the customer principal. Requires CustomerSessionGuard on the route. */
export const CurrentCustomer = createParamDecorator(
  (data: keyof AuthenticatedCustomer | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<CustomerRequest>();
    return data ? request.customer?.[data] : request.customer;
  },
);
