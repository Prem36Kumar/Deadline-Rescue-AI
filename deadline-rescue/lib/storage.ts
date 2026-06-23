import { db } from './firebase'
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore'
import type { SavedDeadline } from './dashboard-types'

const COL = 'deadlines'

export async function saveDeadline(d: SavedDeadline) {
  try { await addDoc(collection(db, COL), d) } catch(e) { console.error(e) }
}

export async function getSavedDeadlines(): Promise<SavedDeadline[]> {
  try {
    const q = query(collection(db, COL), orderBy('saved_at', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ ...(d.data() as SavedDeadline), _docId: d.id }))
  } catch { return [] }
}

export async function removeDeadline(docId: string) {
  try { await deleteDoc(doc(db, COL, docId)) } catch(e) { console.error(e) }
}
