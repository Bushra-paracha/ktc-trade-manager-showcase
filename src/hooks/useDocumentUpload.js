import { useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const BUCKET = 'order-documents';

export function useDocumentUpload() {
  // Uploads a file to Storage, then updates the order_documents row with
  // the file path, name, and bumps status to "Uploaded".
  const uploadDocument = useCallback(async (docId, orderId, file, uploaderEmail) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `${orderId}/${docId}-${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false });

    if (uploadError) {
      return { error: uploadError.message };
    }

    const { error: updateError } = await supabase
      .from('order_documents')
      .update({
        file_path: path,
        file_name: file.name,
        uploaded_by: uploaderEmail || null,
        status: 'Uploaded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', docId);

    if (updateError) {
      await supabase.storage.from(BUCKET).remove([path]);
      return { error: updateError.message };
    }

    return { success: true, path };
  }, []);

  // Generates a temporary signed URL to view/download a private file
  const getSignedUrl = useCallback(async (path, expiresInSeconds = 60) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresInSeconds);

    if (error) return { error: error.message };
    return { url: data.signedUrl };
  }, []);

  // Removes the file from Storage and clears the file fields on the row
  const removeDocument = useCallback(async (docId, path) => {
    if (path) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([path]);
      if (storageError) return { error: storageError.message };
    }
    const { error } = await supabase
      .from('order_documents')
      .update({ file_path: null, file_name: null, status: 'Pending', updated_at: new Date().toISOString() })
      .eq('id', docId);

    if (error) return { error: error.message };
    return { success: true };
  }, []);

  return { uploadDocument, getSignedUrl, removeDocument };
}
