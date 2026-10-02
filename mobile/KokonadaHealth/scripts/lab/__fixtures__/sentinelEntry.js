// A PLANTED import of the Design Lab, for the exclusion check's own tests. It stands in for a
// release-path file that reaches the lab by mistake: every check must find it and fail. It is
// never imported by the app, and it is the only file outside the lab allowed to import the lab
// for that reason (labExclusion.test.ts).
import { LAB_SENTINEL } from '../../../src/design/lab/sentinel';

export const planted = LAB_SENTINEL;
