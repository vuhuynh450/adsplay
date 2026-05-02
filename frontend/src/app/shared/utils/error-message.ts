export const getErrorMessage = (error: unknown, fallback: string) => {
  const candidate = error as {
    error?: {
      error?: {
        message?: string;
      };
      message?: string;
    };
    message?: string;
  };

  return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || fallback;
};
